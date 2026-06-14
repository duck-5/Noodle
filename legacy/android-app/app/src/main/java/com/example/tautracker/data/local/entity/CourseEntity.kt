package com.example.tautracker.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "courses")
data class CourseEntity(
    @PrimaryKey val id: Long,
    val shortName: String?,
    val fullName: String?,
    val idNumber: String?,
    val customColorHex: String? = null,
    val isHidden: Boolean = false
)
